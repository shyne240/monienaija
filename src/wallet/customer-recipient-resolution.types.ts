/** Lookup mechanisms accepted for customer-facing recipient resolution. */
export enum CustomerRecipientLookupMode {
  /** 10-digit system-issued MonieNaija receiving number. */
  MONIENAIJA_NUMBER = 'MONIENAIJA_NUMBER',
  /** Nigerian phone in any accepted representation (canonicalized server-side). */
  PHONE = 'PHONE',
}

/**
 * Internal resolved recipient. NEVER serialized over HTTP: contains the
 * financial identifiers that only the server may know for orchestration
 * (transfers). The HTTP-facing projection is CustomerRecipientPublicView.
 */
export interface ResolvedRecipient {
  lookupMode: CustomerRecipientLookupMode;
  /** Owner of the destination (server-side only; e.g. self-transfer guard). */
  ownerCustomerId: string;
  /** Destination CustomerWallet (registry identifier). */
  customerWalletId: string;
  /** Destination WalletAccount (financial identifier; server-side only). */
  walletAccountId: string;
  currency: string;
  /** The recipient's own receiving number when issued (shareable identity). */
  receivingNumber: string | null;
  /** Canonical +234 phone (only populated for PHONE lookups). */
  canonicalPhone: string | null;
  displayName: string;
}

/** Safe recipient information for customer UX confirmation screens. */
export interface CustomerRecipientPublicView {
  lookupMode: CustomerRecipientLookupMode;
  displayName: string;
  receivingNumber: string | null;
  canonicalPhone: string | null;
  currency: string;
}

export function toPublicRecipientView(resolved: ResolvedRecipient): CustomerRecipientPublicView {
  return {
    lookupMode: resolved.lookupMode,
    displayName: resolved.displayName,
    receivingNumber: resolved.receivingNumber,
    canonicalPhone: resolved.canonicalPhone,
    currency: resolved.currency,
  };
}
