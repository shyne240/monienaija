export enum WalletStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CLOSED = 'CLOSED',
}

/**
 * Wallet owner classification (migration `1785753600116`, extended by `1785753600118`).
 * `REVIEW` is the fail-closed classification for an ambiguous historical owner reference and is
 * never a resolution target; `SYSTEM` is platform custody backed by the authoritative
 * `wallet_system_owners` registry and is deliberately not a customer/agent financial lane.
 */
export enum WalletOwnerClass {
  CUSTOMER = 'CUSTOMER',
  AGENT = 'AGENT',
  REVIEW = 'REVIEW',
  SYSTEM = 'SYSTEM',
}
