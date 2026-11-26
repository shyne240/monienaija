export enum CustomerClassKind {
  CUSTOMER = 'CUSTOMER',
}

export enum CustomerClassStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
  DEPRECATED = 'DEPRECATED',
}

export enum CustomerClassConfigurationStatus {
  CONFIGURED = 'CONFIGURED',
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  DISABLED = 'DISABLED',
}

/** How an assignment came to exist. Registration/backfill/tier-default provenance is never manual. */
export enum CustomerClassAssignmentSource {
  REGISTRATION_DEFAULT = 'REGISTRATION_DEFAULT',
  MANUAL = 'MANUAL',
  BACKFILL = 'BACKFILL',
  SWITCH = 'SWITCH',
  /** Automatic assignment/re-evaluation driven by the verified tier's approved default. */
  TIER_DEFAULT = 'TIER_DEFAULT',
}

export const CUSTOMER_CLASS_CODE_PATTERN = /^[A-Z0-9_]{3,80}$/;
