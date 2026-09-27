export enum LimitProfileKind {
  CUSTOMER = 'CUSTOMER',
  AGENT = 'AGENT',
  SYSTEM = 'SYSTEM',
  UNIVERSAL = 'UNIVERSAL',
}

export enum LimitProfileStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
  DEPRECATED = 'DEPRECATED',
}

export enum LimitProfileConfigurationStatus {
  CONFIGURED = 'CONFIGURED',
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  DISABLED = 'DISABLED',
}

export enum LimitDimension {
  MIN_AMOUNT_PER_TX = 'MIN_AMOUNT_PER_TX',
  MAX_AMOUNT_PER_TX = 'MAX_AMOUNT_PER_TX',
  DAILY_AMOUNT = 'DAILY_AMOUNT',
  WEEKLY_AMOUNT = 'WEEKLY_AMOUNT',
  MONTHLY_AMOUNT = 'MONTHLY_AMOUNT',
  YEARLY_AMOUNT = 'YEARLY_AMOUNT',
  DAILY_COUNT = 'DAILY_COUNT',
  WEEKLY_COUNT = 'WEEKLY_COUNT',
  MONTHLY_COUNT = 'MONTHLY_COUNT',
  YEARLY_COUNT = 'YEARLY_COUNT',
  WALLET_BALANCE_MAX = 'WALLET_BALANCE_MAX',
}

export const LIMIT_AMOUNT_DIMENSIONS: readonly LimitDimension[] = [
  LimitDimension.MIN_AMOUNT_PER_TX,
  LimitDimension.MAX_AMOUNT_PER_TX,
  LimitDimension.DAILY_AMOUNT,
  LimitDimension.WEEKLY_AMOUNT,
  LimitDimension.MONTHLY_AMOUNT,
  LimitDimension.YEARLY_AMOUNT,
  LimitDimension.WALLET_BALANCE_MAX,
] as const;

export const LIMIT_COUNT_DIMENSIONS: readonly LimitDimension[] = [
  LimitDimension.DAILY_COUNT,
  LimitDimension.WEEKLY_COUNT,
  LimitDimension.MONTHLY_COUNT,
  LimitDimension.YEARLY_COUNT,
] as const;

export enum LimitDirection {
  INCOMING = 'INCOMING',
  OUTGOING = 'OUTGOING',
  BOTH = 'BOTH',
}
