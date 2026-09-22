export enum CustomerReceivingNumberStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
}

/** How the number was (deterministically) produced. */
export enum CustomerReceivingNumberSource {
  /** nationalSignificantNumber of the customer's canonical Nigerian phone. */
  PHONE_NSN = 'PHONE_NSN',
}
