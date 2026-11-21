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

/** How an assignment came to exist. Registration/backfill provenance is never manual. */
export enum CustomerClassAssignmentSource {
  REGISTRATION_DEFAULT = 'REGISTRATION_DEFAULT',
  MANUAL = 'MANUAL',
  BACKFILL = 'BACKFILL',
  SWITCH = 'SWITCH',
}

export const CUSTOMER_CLASS_CODE_PATTERN = /^[A-Z0-9_]{3,80}$/;
