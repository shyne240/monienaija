/**
 * Provider-independent banking capability contracts.
 *
 * These interfaces describe what a banking provider can be asked to do, in terms the financial
 * engine already understands. They deliberately do NOT model provider quirks: an adapter that has to
 * explain a provider's special case does so inside its own result, not by widening these types.
 *
 * Two rules are enforced by the shape of these types rather than by convention:
 *
 * 1. **A capability is either advertised or absent.** `BankingProviderCapabilities` is not a bag of
 *    optional booleans that default to usable; every field must be present, so a new provider must
 *    state its position explicitly. A provider with an unimplemented capability leaves it `false`.
 * 2. **Uncertainty is a first-class outcome.** Every money-moving call returns a result whose
 *    `outcome` distinguishes "the provider refused" from "we do not know", because the second must
 *    never be treated as the first. `UNKNOWN` is not an error code; it is a required state.
 */

/** Capability identifier used for configuration, readiness and audit. */
export type BankingCapabilityKey =
  | 'BANK_DIRECTORY'
  | 'ACCOUNT_NAME_ENQUIRY'
  | 'VIRTUAL_ACCOUNT_PROVISION'
  | 'VIRTUAL_ACCOUNT_STATUS'
  | 'OUTBOUND_TRANSFER_SUBMIT'
  | 'TRANSFER_STATUS_ENQUIRY'
  | 'INBOUND_PAYMENT_VERIFICATION'
  | 'SETTLEMENT_VERIFICATION'
  | 'PROVIDER_BALANCE_ENQUIRY'
  | 'RECONCILIATION_OBSERVATIONS'
  | 'WEBHOOK_INGESTION'
  | 'REFUND_INITIATION';

/**
 * Documented maturity of a capability for the configured provider.
 *
 * `DEPRECATED` exists because one real capability (`wallet-balance`) is documented as deprecated.
 * It is advertised honestly so operators can see why nothing financial depends on it.
 */
export type BankingCapabilityMaturity = 'SUPPORTED' | 'DEPRECATED' | 'UNCONFIRMED';

export interface BankingCapabilityDescriptor {
  readonly key: BankingCapabilityKey;
  readonly maturity: BankingCapabilityMaturity;
  /** True only when a documented provider contract exists. Never optimistic. */
  readonly documented: boolean;
  /** False for capabilities whose real-world use needs commercial entitlement we do not assert. */
  readonly requiresCommercialEntitlement: boolean;
  /** Short operator-facing note. Must not contain secrets or invented business claims. */
  readonly note: string;
}

/**
 * Every capability must be stated. Optional booleans would let a provider be silently assumed
 * capable, which is precisely the failure mode this boundary exists to prevent.
 */
export type BankingProviderCapabilities = Readonly<Record<BankingCapabilityKey, boolean>>;

export interface BankingProviderDescriptor {
  /** Stable provider key used in configuration, e.g. `MONNIFY`. */
  readonly key: string;
  readonly displayName: string;
  /**
   * The environment this adapter instance is bound to.
   *
   * It belongs in the descriptor rather than only in adapter options because governance has to
   * verify that an approved configuration names the environment the code is actually wired to. A
   * production credential approved against a sandbox adapter would pass a key-only check.
   */
  readonly environment: BankingEnvironment;
  readonly capabilities: BankingProviderCapabilities;
  readonly descriptors: readonly BankingCapabilityDescriptor[];
}

/** Environment a provider adapter is bound to. Production is a distinct, stricter mode. */
export type BankingEnvironment = 'sandbox' | 'production';

/**
 * Normalized provider outcome for anything that could move money or reveal financial state.
 *
 * `NOT_SENT` and `UNKNOWN` are deliberately distinct: nothing was transmitted versus something may
 * have been. Collapsing them is how a timed-out transfer gets submitted twice.
 */
export type BankingProviderOutcome = 'ACCEPTED' | 'REJECTED' | 'PENDING' | 'NOT_SENT' | 'UNKNOWN';

export type BankingProviderErrorCategory =
  | 'VALIDATION'
  | 'CAPABILITY'
  | 'CONFIGURATION'
  | 'AUTHENTICATION'
  | 'ENTITLEMENT'
  | 'TRANSPORT'
  | 'TIMEOUT'
  | 'CONTRACT'
  | 'PROVIDER_REJECTED'
  | 'RATE_LIMITED';

/**
 * A normalized provider error. Carries no credential material by construction: adapters build these
 * from allow-listed fields, never by serialising a request or a raw provider response.
 */
export interface BankingProviderError {
  readonly category: BankingProviderErrorCategory;
  /** Stable machine code owned by us, safe to branch on and safe to log. */
  readonly code: string;
  /** Redacted, human-readable detail. Never a raw provider payload. */
  readonly detail: string;
  /** Provider's own code, if it supplied one verbatim and it is not sensitive. */
  readonly providerCode?: string;
}

/** Result envelope. A discriminated union so callers cannot read `.value` on a failure. */
export type BankingProviderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: BankingProviderError };

export interface BankingRequestContext {
  readonly correlationId: string;
  /** Caller-supplied abort signal; adapters must honour it and must not retry on abort. */
  readonly signal?: AbortSignal;
}

// ---------------------------------------------------------------------------- bank directory

export interface BankDirectoryEntry {
  /** Provider's own code. Never translated to another provider's code. */
  readonly providerBankCode: string;
  readonly name: string;
  readonly active: boolean;
  /** NIBSS code when the provider supplies one, kept separate from the provider code. */
  readonly nibssBankCode?: string;
}

export interface BankDirectorySnapshot {
  readonly provider: string;
  readonly environment: BankingEnvironment;
  readonly banks: readonly BankDirectoryEntry[];
  /** When this snapshot was produced by the provider (not when it was cached). */
  readonly observedAt: string;
  readonly correlationId: string;
}

// ---------------------------------------------------------------- account-name enquiry

export interface AccountNameEnquiryRequest {
  readonly providerBankCode: string;
  readonly accountNumber: string;
}

export type AccountNameEnquiryOutcome = 'RESOLVED' | 'NOT_FOUND' | 'UNAVAILABLE';

export interface AccountNameEnquiryResult {
  readonly outcome: AccountNameEnquiryOutcome;
  readonly providerBankCode: string;
  readonly accountNumber: string;
  /** Present only for `RESOLVED`. */
  readonly accountName?: string;
  /** Provider's reference for this enquiry, for dispute and audit. */
  readonly providerReference?: string;
  /**
   * Always false. Modeled explicitly so a future change must be a deliberate, reviewed decision:
   * resolving a name proves the account exists, never that the caller owns it.
   */
  readonly establishesAccountOwnership: false;
  readonly correlationId: string;
}

// ------------------------------------------------------------------ virtual accounts

export type VirtualAccountProvisionOutcome =
  | 'PROVISIONED'
  | 'ALREADY_PROVISIONED'
  | 'PENDING'
  | 'UNKNOWN'
  | 'REJECTED';

export interface VirtualAccountProvisionRequest {
  /** Our durable, stable reference. Reused on every retry; never regenerated. */
  readonly accountReference: string;
  readonly accountName: string;
  readonly customerName: string;
  readonly customerEmail: string;
  readonly currency: string;
  readonly providerBvn?: string;
  readonly providerNin?: string;
  readonly correlationId: string;
}

export interface ProvisionedBankAccount {
  readonly bankName: string;
  readonly providerBankCode: string;
  readonly accountNumber: string;
  readonly accountName: string;
}

export interface VirtualAccountProvisionResult {
  readonly outcome: VirtualAccountProvisionOutcome;
  readonly accountReference: string;
  readonly providerReference?: string;
  /** Only present when the provider authoritatively returned them. Never synthesized. */
  readonly accounts: readonly ProvisionedBankAccount[];
  readonly status?: string;
  readonly correlationId: string;
}

export type VirtualAccountStatusOutcome = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN' | 'NOT_FOUND';

export interface VirtualAccountStatusResult {
  readonly outcome: VirtualAccountStatusOutcome;
  readonly accountReference: string;
  readonly accounts: readonly ProvisionedBankAccount[];
  readonly correlationId: string;
}

// ------------------------------------------------------------------- outbound transfers

export interface OutboundTransferRequest {
  /**
   * Our operation identity. Bound to the financial commitment and reused verbatim on every
   * legitimate retry so a provider cannot see two operations for one commitment.
   */
  readonly operationReference: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly destinationBankCode: string;
  readonly destinationAccountNumber: string;
  /** Verified account name, when the provider contract requires it on submission. */
  readonly destinationAccountName: string;
  readonly narration: string;
  readonly correlationId: string;
}

export interface OutboundTransferSubmissionResult {
  readonly outcome: BankingProviderOutcome;
  readonly operationReference: string;
  readonly providerReference?: string;
  /**
   * True when the provider requires a second factor before funds move. An OTP challenge is NOT an
   * accepted transfer, and the implementation must not treat it as one.
   */
  readonly requiresAdditionalAuthorization?: boolean;
  readonly correlationId: string;
}

export type TransferStatusOutcome =
  | 'PENDING'
  | 'SUCCESSFUL'
  | 'REJECTED'
  | 'FAILED'
  | 'REVERSED'
  | 'UNKNOWN'
  | 'NOT_FOUND';

export interface TransferStatusResult {
  readonly outcome: TransferStatusOutcome;
  readonly operationReference: string;
  readonly providerReference?: string;
  readonly amountMinor?: string;
  readonly currency?: string;
  /** Provider's raw status string, preserved so meaningful distinctions are never lost. */
  readonly providerStatus?: string;
  readonly completedAt?: string;
  readonly correlationId: string;
}

// ----------------------------------------------------------------- inbound verification

export type InboundVerificationOutcome =
  | 'VERIFIED'
  | 'NOT_FOUND'
  | 'PENDING'
  | 'CONFLICT'
  | 'UNKNOWN';

export interface InboundPaymentVerificationResult {
  readonly outcome: InboundVerificationOutcome;
  readonly providerTransactionReference: string;
  readonly amountMinor?: string;
  readonly currency?: string;
  readonly receivingAccountNumber?: string;
  readonly providerBankCode?: string;
  readonly paidAt?: string;
  readonly providerStatus?: string;
  /**
   * Gross amount the payer sent. Kept distinct from any settlement figure because a provider
   * report of a payment is not a statement that the institution received settled funds.
   */
  readonly grossAmountMinor?: string;
  readonly providerFeeMinor?: string;
  readonly correlationId: string;
}

// ------------------------------------------------------------------- settlement

export type SettlementVerificationOutcome =
  | 'VERIFIED'
  | 'NOT_FOUND'
  | 'PENDING'
  | 'PARTIAL'
  | 'UNKNOWN';

export interface SettlementVerificationResult {
  readonly outcome: SettlementVerificationOutcome;
  readonly settlementReference: string;
  readonly grossAmountMinor?: string;
  readonly providerFeeMinor?: string;
  readonly netAmountMinor?: string;
  readonly settlementAccountNumber?: string;
  readonly settlementBankCode?: string;
  readonly settledAt?: string;
  readonly periodStart?: string;
  readonly periodEnd?: string;
  readonly correlationId: string;
}

// ------------------------------------------------------------------- balance

export interface ProviderBalanceResult {
  readonly currency: string;
  readonly availableMinor: string;
  /** Always false: a provider dashboard balance is not the MonieNaija ledger balance. */
  readonly isLedgerBalance: false;
  readonly observedAt: string;
  readonly correlationId: string;
}

// -------------------------------------------------------------- reconciliation

export interface ReconciliationObservationRequest {
  readonly from: string;
  readonly to: string;
  readonly cursor?: string;
  readonly limit?: number;
  readonly correlationId: string;
}

export interface ReconciliationObservation {
  readonly providerTransactionReference: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly status: string;
  readonly occurredAt: string;
  readonly providerBankCode?: string;
  readonly accountNumber?: string;
}

export interface ReconciliationObservationPage {
  readonly observations: readonly ReconciliationObservation[];
  readonly nextCursor?: string;
  readonly correlationId: string;
}

/**
 * The single banking provider boundary.
 *
 * Every method is optional because a provider genuinely may not support a capability; the registry
 * refuses to advertise a capability whose method is absent, and never the reverse. Financial
 * submission is kept textually distinct from read-only enquiry so a reviewer can see at a glance
 * which calls can move money.
 */
export interface BankingProvider {
  readonly descriptor: BankingProviderDescriptor;

  // ---- read-only
  listBanks?(context: BankingRequestContext): Promise<BankingProviderResult<BankDirectorySnapshot>>;
  enquireAccountName?(
    request: AccountNameEnquiryRequest,
    context: BankingRequestContext,
  ): Promise<BankingProviderResult<AccountNameEnquiryResult>>;
  getVirtualAccountStatus?(
    accountReference: string,
    context: BankingRequestContext,
  ): Promise<BankingProviderResult<VirtualAccountStatusResult>>;
  getTransferStatus?(
    operationReference: string,
    context: BankingRequestContext,
  ): Promise<BankingProviderResult<TransferStatusResult>>;
  verifyInboundPayment?(
    providerTransactionReference: string,
    context: BankingRequestContext,
  ): Promise<BankingProviderResult<InboundPaymentVerificationResult>>;
  verifySettlement?(
    settlementReference: string,
    context: BankingRequestContext,
  ): Promise<BankingProviderResult<SettlementVerificationResult>>;
  getProviderBalance?(
    context: BankingRequestContext,
  ): Promise<BankingProviderResult<ProviderBalanceResult>>;
  listReconciliationObservations?(
    request: ReconciliationObservationRequest,
    context: BankingRequestContext,
  ): Promise<BankingProviderResult<ReconciliationObservationPage>>;

  // ---- money-moving (submission only; settlement is never performed by a provider adapter)
  provisionVirtualAccount?(
    request: VirtualAccountProvisionRequest,
    context: BankingRequestContext,
  ): Promise<BankingProviderResult<VirtualAccountProvisionResult>>;
  submitOutboundTransfer?(
    request: OutboundTransferRequest,
    context: BankingRequestContext,
  ): Promise<BankingProviderResult<OutboundTransferSubmissionResult>>;
}
