export enum CustomerFinancialAccountBindingState {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REPAIR_REQUIRED = 'REPAIR_REQUIRED',
  CLOSED = 'CLOSED',
}

export enum CustomerFinancialAccountBindingMode {
  PROVISION_NEW = 'PROVISION_NEW',
  BIND_EXISTING = 'BIND_EXISTING',
}
