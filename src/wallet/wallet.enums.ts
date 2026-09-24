export enum WalletStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CLOSED = 'CLOSED',
}

/**
 * F-1 — typed owner of a financial WalletAccount.
 *
 * The financial core distinguishes participants explicitly instead of assuming
 * every account belongs to a Customer. Pre-existing rows default to CUSTOMER,
 * which is correct for every account created before Agent existed.
 */
export enum WalletOwnerType {
  CUSTOMER = 'CUSTOMER',
  AGENT = 'AGENT',
}
