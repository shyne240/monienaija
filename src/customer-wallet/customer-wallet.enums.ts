export enum CustomerWalletStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CLOSED = 'CLOSED',
}

export enum CustomerWalletType {
  PRIMARY = 'PRIMARY',
  SAVINGS = 'SAVINGS',
  BUSINESS = 'BUSINESS',
  ESCROW = 'ESCROW',
}

export enum WalletProvisioningHistoryAction {
  PROVISIONED = 'PROVISIONED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  ALIAS_ADDED = 'ALIAS_ADDED',
  OWNERSHIP_CREATED = 'OWNERSHIP_CREATED',
}
