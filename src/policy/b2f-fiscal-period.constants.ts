export const B2F_FISCAL_PERIOD_CONTRACT_NAME = 'B2F-FISCAL-PERIOD' as const;
export const B2F_FISCAL_PERIOD_CONTRACT_VERSION = 1 as const;
export const B2F_FISCAL_PERIOD_CONTRACT_DOCUMENT = 'docs/B2F-FISCAL-PERIOD-CONTRACT.md' as const;

export const B2F_BOOK_KEY = 'finance.book.ng.primary' as const;
export const B2F_BOOK_VERSION = 1 as const;
export const B2F_LEGAL_ENTITY_REFERENCE = 'finance.legal-entity.ng.primary' as const;
export const B2F_JURISDICTION = 'NG' as const;
export const B2F_ACCOUNTING_BASIS = 'ACCRUAL' as const;
export const B2F_FUNCTIONAL_CURRENCY = 'NGN' as const;
export const B2F_ACCOUNTING_UNIT = 'CUSTOMER_FUNDS' as const;
export const B2F_CALENDAR_KEY = 'finance.calendar.ng.gregorian' as const;
export const B2F_CALENDAR_VERSION = 1 as const;
export const B2F_PERIOD_TIME_ZONE = 'UTC' as const;

export const B2F_FISCAL_YEAR_CREATE_IDEMPOTENCY_SCOPE =
  'b2.finance.fiscal-period.create.idempotency.v1' as const;
export const B2F_PERIOD_LIFECYCLE_IDEMPOTENCY_SCOPE =
  'b2.finance.fiscal-period.lifecycle.idempotency.v1' as const;
export const B2F_FISCAL_PERIOD_IDEMPOTENCY_RETENTION_SECONDS = 86_400;

export const B2F_FISCAL_YEAR_REFERENCE_PREFIX = 'b2f-fiscal-year' as const;
export const B2F_PERIOD_REFERENCE_PREFIX = 'b2f-period' as const;
export const B2F_PERIOD_DECISION_REFERENCE_PREFIX = 'b2f-period-decision' as const;
export const B2F_FISCAL_PERIOD_AUDIT_ACTOR = 'b2f-fiscal-period' as const;
export const B2F_FISCAL_YEAR_AUDIT_ENTITY_TYPE = 'B2F_FISCAL_YEAR' as const;
export const B2F_ACCOUNTING_PERIOD_AUDIT_ENTITY_TYPE = 'B2F_ACCOUNTING_PERIOD' as const;
export const B2F_ACCOUNTING_PERIOD_RESOURCE_TYPE = 'B2F_ACCOUNTING_PERIOD' as const;

export const B2F_PERIOD_ACTIONS = {
  OPEN: 'FINANCE_PERIOD_OPEN',
  SOFT_CLOSE: 'FINANCE_PERIOD_SOFT_CLOSE',
  HARD_CLOSE: 'FINANCE_PERIOD_HARD_CLOSE',
  REOPEN: 'FINANCE_PERIOD_REOPEN',
  RETIRE: 'FINANCE_PERIOD_RETIRE',
} as const;
