/**
 * V1-COMMERCIAL-02 — Product Catalogue vocabulary.
 *
 * These enums classify catalogue entries; they are NOT product codes. The single authoritative
 * product identity is `products.code`, which carries the same identifiers the runtime flows
 * already pass to limit enforcement and commercial decision snapshots.
 */

/** Flow domain the product belongs to (audit doc §12 vocabulary). */
export enum ProductDomain {
  CUSTOMER = 'CUSTOMER',
  AGENT = 'AGENT',
  AGGREGATOR = 'AGGREGATOR',
  FINANCE = 'FINANCE',
  SUPPORT = 'SUPPORT',
  PLATFORM = 'PLATFORM',
}

/** Catalogue lifecycle of the product entry. */
export enum ProductStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
  DEPRECATED = 'DEPRECATED',
}

/** Whether commercial configuration exists for the product (rates/thresholds live elsewhere). */
export enum ProductConfigurationStatus {
  CONFIGURED = 'CONFIGURED',
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  DISABLED = 'DISABLED',
}

/** Project scope terminology reused from the Capability Registry. */
export enum ProductScope {
  V1 = 'V1',
  V2 = 'V2',
}

export const PRODUCT_CODE_PATTERN = /^[A-Z0-9_]{3,80}$/;
