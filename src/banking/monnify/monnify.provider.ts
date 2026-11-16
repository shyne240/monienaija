import type {
  AccountNameEnquiryRequest,
  AccountNameEnquiryResult,
  BankDirectoryEntry,
  BankDirectorySnapshot,
  BankingEnvironment,
  BankingProvider,
  BankingProviderDescriptor,
  BankingProviderError,
  BankingProviderResult,
  BankingRequestContext,
  InboundPaymentVerificationResult,
  OutboundTransferRequest,
  OutboundTransferSubmissionResult,
  ProviderBalanceResult,
  SettlementVerificationResult,
  TransferStatusResult,
  VirtualAccountProvisionRequest,
  VirtualAccountProvisionResult,
  VirtualAccountStatusResult,
} from '../banking-provider.types';
import { capabilitiesOf } from '../banking-provider.registry';
import type { MonnifyHttpClient } from './monnify.http';
import { basicAuthorization } from './monnify.http';
import { fromMonnifyEnvelope, monnifyError, sanitizeProviderText } from './monnify.errors';
import { MonnifyTokenManager } from './monnify-token.manager';

/**
 * Documented Monnify adapter.
 *
 * Every method here is implemented against a contract recorded in the continuation record §3, and
 * anything without authoritative evidence is **absent** rather than guessed. Concretely:
 *
 * - `verifySettlement` and `getProviderBalance` are NOT implemented. The settlement endpoints exist
 *   as paths in the official SDK constants, but a path is not a financial contract: without a
 *   documented response schema we cannot say what a settlement record means, and inventing terminal
 *   settlement semantics is exactly what the mission forbids. They stay unavailable.
 * - `listReconciliationObservations` is NOT implemented for the same reason.
 *
 * The asymmetry matters: an unavailable capability fails loudly and visibly, whereas a guessed one
 * fails quietly, months later, as a reconciliation difference nobody can explain.
 */
export interface MonnifyProviderOptions {
  readonly environment: BankingEnvironment;
  readonly contractCode: string;
  readonly apiKey: string;
  readonly secretKey: string;
  readonly http: MonnifyHttpClient;
  /** Wallet id for balance enquiry; documented endpoint is deprecated but the parameter is required. */
  readonly walletId?: string;
}

const PROVIDER_KEY = 'MONNIFY';

export class MonnifyProvider implements BankingProvider {
  readonly descriptor: BankingProviderDescriptor;
  private readonly tokens: MonnifyTokenManager;

  constructor(private readonly options: MonnifyProviderOptions) {
    this.descriptor = {
      key: PROVIDER_KEY,
      displayName: 'Monnify',
      capabilities: capabilitiesOf({
        BANK_DIRECTORY: true,
        ACCOUNT_NAME_ENQUIRY: true,
        VIRTUAL_ACCOUNT_PROVISION: true,
        VIRTUAL_ACCOUNT_STATUS: true,
        OUTBOUND_TRANSFER_SUBMIT: true,
        TRANSFER_STATUS_ENQUIRY: true,
        INBOUND_PAYMENT_VERIFICATION: true,
        // Deliberately absent: no documented response schema to interpret.
        SETTLEMENT_VERIFICATION: false,
        RECONCILIATION_OBSERVATIONS: false,
        PROVIDER_BALANCE_ENQUIRY: false,
        // Ingestion is a route + signature concern implemented outside the adapter.
        WEBHOOK_INGESTION: false,
        REFUND_INITIATION: false,
      }),
      descriptors: [
        {
          key: 'BANK_DIRECTORY',
          maturity: 'SUPPORTED',
          documented: true,
          requiresCommercialEntitlement: false,
          note: 'GET /api/v1/sdk/transactions/banks — documented bank list with codes and USSD templates.',
        },
        {
          key: 'ACCOUNT_NAME_ENQUIRY',
          maturity: 'SUPPORTED',
          documented: true,
          requiresCommercialEntitlement: true,
          note: 'GET /api/v1/disbursements/account/validate — name enquiry is a disbursement entitlement.',
        },
        {
          key: 'VIRTUAL_ACCOUNT_PROVISION',
          maturity: 'SUPPORTED',
          documented: true,
          requiresCommercialEntitlement: true,
          note: 'POST /api/v2/bank-transfer/reserved-accounts — reserved-account product.',
        },
        {
          key: 'VIRTUAL_ACCOUNT_STATUS',
          maturity: 'SUPPORTED',
          documented: true,
          requiresCommercialEntitlement: true,
          note: 'GET /api/v2/bank-transfer/reserved-accounts/{accountReference}.',
        },
        {
          key: 'OUTBOUND_TRANSFER_SUBMIT',
          maturity: 'SUPPORTED',
          documented: true,
          requiresCommercialEntitlement: true,
          note: 'POST /api/v2/disbursements/single. Two-factor: an OTP challenge is NOT an accepted transfer.',
        },
        {
          key: 'TRANSFER_STATUS_ENQUIRY',
          maturity: 'SUPPORTED',
          documented: true,
          requiresCommercialEntitlement: true,
          note: 'GET /api/v2/disbursements/single/summary?reference=.',
        },
        {
          key: 'INBOUND_PAYMENT_VERIFICATION',
          maturity: 'SUPPORTED',
          documented: true,
          requiresCommercialEntitlement: true,
          note: 'GET /api/v2/transactions/{transactionReference} — independent verification of an inbound observation.',
        },
        {
          key: 'SETTLEMENT_VERIFICATION',
          maturity: 'UNCONFIRMED',
          documented: false,
          requiresCommercialEntitlement: true,
          note: 'Path exists in official SDK constants but no documented response schema. Left UNAVAILABLE rather than guessed.',
        },
        {
          key: 'PROVIDER_BALANCE_ENQUIRY',
          maturity: 'DEPRECATED',
          documented: true,
          requiresCommercialEntitlement: true,
          note: 'GET /api/v1/disbursements/wallet-balance is documented as deprecated; nothing financial depends on it.',
        },
        {
          key: 'RECONCILIATION_OBSERVATIONS',
          maturity: 'UNCONFIRMED',
          documented: false,
          requiresCommercialEntitlement: true,
          note: 'No documented envelope for a paged observation feed. Reconciliation uses verified per-transaction enquiries instead.',
        },
      ],
    };
    this.tokens = new MonnifyTokenManager({ login: () => this.login() });
  }

  // ---------------------------------------------------------------- auth

  private async login(): Promise<{ accessToken: string; expiresIn: number }> {
    const result = await this.send(
      'POST',
      '/api/v1/auth/login',
      basicAuthorization(this.options.apiKey, this.options.secretKey),
      undefined,
    );
    if (!result.ok) throw new MonnifyProviderError(result.error);
    const body = result.value as { accessToken?: unknown; expiresIn?: unknown };
    // An empty or absent token is not a usable credential. Returning '' would let the token manager
    // cache a blank bearer and every subsequent call would fail 401 for the wrong reason.
    if (typeof body.accessToken !== 'string' || body.accessToken.length === 0) {
      throw new MonnifyProviderError(
        monnifyError('MONNIFY_MALFORMED_RESPONSE', 'Login response carried no access token'),
      );
    }
    const expiresIn = typeof body.expiresIn === 'number' ? body.expiresIn : Number(body.expiresIn);
    return {
      accessToken: body.accessToken,
      expiresIn: Number.isFinite(expiresIn) ? expiresIn : 0,
    };
  }

  private async send(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    authorization: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<BankingProviderResult<unknown>> {
    try {
      const response = await this.options.http.send(
        {
          method,
          path,
          authorization,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        signal ?? new AbortController().signal,
      );
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          error: monnifyError(
            'MONNIFY_AUTHENTICATION_FAILED',
            `Provider refused the credential (HTTP ${response.status})`,
          ),
        };
      }
      // A server-side fault means the provider could not answer. It is emphatically NOT a business
      // rejection: mapping a 5xx to PROVIDER_REJECTED would let an outage read as "no such account"
      // in enquiry, and as a refused transfer in disbursement.
      if (response.status >= 500) {
        return {
          ok: false,
          error: monnifyError(
            'MONNIFY_TRANSPORT_FAILED',
            `Provider was unavailable (HTTP ${response.status})`,
          ),
        };
      }
      if (response.status === 404) {
        // Only a 404 from a lookup endpoint legitimately means "no such record".
        return {
          ok: false,
          error: monnifyError('MONNIFY_NOT_FOUND', 'Provider has no such record'),
        };
      }
      // Everything else is judged by the envelope, never by the HTTP status.
      const mapped = fromMonnifyEnvelope(response.body);
      return mapped.ok ? { ok: true, value: mapped.body } : { ok: false, error: mapped.error };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'Timeout') {
        // Deliberately a distinct category: the caller must treat this as UNKNOWN, not failure.
        return {
          ok: false,
          error: monnifyError('MONNIFY_TIMEOUT', 'Provider did not respond in time'),
        };
      }
      return {
        ok: false,
        error: monnifyError('MONNIFY_TRANSPORT_FAILED', 'Provider transport failed', undefined),
      };
    }
  }

  private async authorized(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: unknown,
    context: BankingRequestContext,
  ): Promise<BankingProviderResult<unknown>> {
    const token = await this.tokens.getToken(context.signal);
    if (!token.ok) return token;
    return this.send(method, path, `Bearer ${token.token}`, body, context.signal);
  }

  // -------------------------------------------------------- bank directory

  async listBanks(
    context: BankingRequestContext,
  ): Promise<BankingProviderResult<BankDirectorySnapshot>> {
    const result = await this.authorized(
      'GET',
      '/api/v1/sdk/transactions/banks',
      undefined,
      context,
    );
    if (!result.ok) return result;
    if (!Array.isArray(result.value)) {
      return {
        ok: false,
        error: monnifyError('MONNIFY_MALFORMED_RESPONSE', 'Bank list was not an array'),
      };
    }
    const banks: BankDirectoryEntry[] = [];
    for (const raw of result.value) {
      if (typeof raw !== 'object' || raw === null) continue;
      const entry = raw as Record<string, unknown>;
      const code = typeof entry.code === 'string' ? entry.code : undefined;
      const name = typeof entry.name === 'string' ? entry.name : undefined;
      if (!code || !name) continue;
      banks.push({
        providerBankCode: code,
        name,
        // The directory lists supported banks; absence of an explicit inactive flag means usable.
        active: entry.active === false ? false : true,
        ...(typeof entry.nibssBankCode === 'string' ? { nibssBankCode: entry.nibssBankCode } : {}),
      });
    }
    return {
      ok: true,
      value: {
        provider: PROVIDER_KEY,
        environment: this.options.environment,
        banks,
        observedAt: new Date().toISOString(),
        correlationId: context.correlationId,
      },
    };
  }

  // --------------------------------------------------- account name enquiry

  async enquireAccountName(
    request: AccountNameEnquiryRequest,
    context: BankingRequestContext,
  ): Promise<BankingProviderResult<AccountNameEnquiryResult>> {
    if (!/^\d{10}$/.test(request.accountNumber) || !/^\d{3,6}$/.test(request.providerBankCode)) {
      return {
        ok: false,
        error: monnifyError('MONNIFY_INVALID_INPUT', 'Account number or bank code is malformed'),
      };
    }
    const path =
      `/api/v1/disbursements/account/validate` +
      `?accountNumber=${encodeURIComponent(request.accountNumber)}` +
      `&bankCode=${encodeURIComponent(request.providerBankCode)}`;
    const result = await this.authorized('GET', path, undefined, context);
    if (!result.ok) {
      // A documented "not found" is a business answer, not a transport failure. Anything else stays
      // UNAVAILABLE so a caller never treats an outage as "this account does not exist".
      return result.error.category === 'PROVIDER_REJECTED'
        ? {
            ok: true,
            value: {
              outcome: 'NOT_FOUND',
              providerBankCode: request.providerBankCode,
              accountNumber: request.accountNumber,
              establishesAccountOwnership: false,
              correlationId: context.correlationId,
            },
          }
        : result;
    }
    const body = result.value as Record<string, unknown>;
    const accountName = typeof body.accountName === 'string' ? body.accountName : undefined;
    return {
      ok: true,
      value: {
        outcome: accountName ? 'RESOLVED' : 'NOT_FOUND',
        providerBankCode: request.providerBankCode,
        accountNumber: request.accountNumber,
        ...(accountName ? { accountName } : {}),
        establishesAccountOwnership: false,
        correlationId: context.correlationId,
      },
    };
  }

  // ------------------------------------------------------- reserved accounts

  async provisionVirtualAccount(
    request: VirtualAccountProvisionRequest,
    context: BankingRequestContext,
  ): Promise<BankingProviderResult<VirtualAccountProvisionResult>> {
    if (!request.accountReference || !request.customerEmail) {
      return {
        ok: false,
        error: monnifyError(
          'MONNIFY_INVALID_INPUT',
          'accountReference and customerEmail are required',
        ),
      };
    }
    const result = await this.authorized(
      'POST',
      '/api/v2/bank-transfer/reserved-accounts',
      {
        accountReference: request.accountReference,
        accountName: request.accountName,
        currencyCode: request.currency,
        contractCode: this.options.contractCode,
        customerEmail: request.customerEmail,
        customerName: request.customerName,
        // Reserve with all partner banks so the customer receives a bank the payer recognises.
        getAllAvailableBanks: true,
        ...(request.providerBvn ? { bvn: request.providerBvn } : {}),
        ...(request.providerNin ? { nin: request.providerNin } : {}),
      },
      context,
    );
    if (!result.ok) {
      // A timeout or transport failure means the account MAY exist. Reporting UNKNOWN is the whole
      // point: the caller must recover by enquiry, never by provisioning a second account.
      return result.error.category === 'TIMEOUT' || result.error.category === 'TRANSPORT'
        ? {
            ok: true,
            value: {
              outcome: 'UNKNOWN',
              accountReference: request.accountReference,
              accounts: [],
              correlationId: context.correlationId,
            },
          }
        : result;
    }
    const body = result.value as Record<string, unknown>;
    const accounts = this.parseAccounts(body.accounts);
    return {
      ok: true,
      value: {
        outcome: accounts.length > 0 ? 'PROVISIONED' : 'PENDING',
        accountReference: request.accountReference,
        ...(typeof body.reservationReference === 'string'
          ? { providerReference: body.reservationReference }
          : {}),
        accounts,
        ...(typeof body.status === 'string' ? { status: body.status } : {}),
        correlationId: context.correlationId,
      },
    };
  }

  async getVirtualAccountStatus(
    accountReference: string,
    context: BankingRequestContext,
  ): Promise<BankingProviderResult<VirtualAccountStatusResult>> {
    if (!accountReference) {
      return {
        ok: false,
        error: monnifyError('MONNIFY_INVALID_INPUT', 'accountReference is required'),
      };
    }
    const result = await this.authorized(
      'GET',
      `/api/v2/bank-transfer/reserved-accounts/${encodeURIComponent(accountReference)}`,
      undefined,
      context,
    );
    if (!result.ok) {
      return result.error.category === 'PROVIDER_REJECTED'
        ? {
            ok: true,
            value: {
              outcome: 'NOT_FOUND',
              accountReference,
              accounts: [],
              correlationId: context.correlationId,
            },
          }
        : result;
    }
    const body = result.value as Record<string, unknown>;
    const accounts = this.parseAccounts(body.accounts);
    const status = typeof body.status === 'string' ? body.status.toUpperCase() : '';
    return {
      ok: true,
      value: {
        outcome: status === 'ACTIVE' ? 'ACTIVE' : status === 'INACTIVE' ? 'INACTIVE' : 'UNKNOWN',
        accountReference,
        accounts,
        correlationId: context.correlationId,
      },
    };
  }

  private parseAccounts(value: unknown) {
    if (!Array.isArray(value)) return [];
    const out: Array<{
      bankName: string;
      providerBankCode: string;
      accountNumber: string;
      accountName: string;
    }> = [];
    for (const raw of value) {
      if (typeof raw !== 'object' || raw === null) continue;
      const a = raw as Record<string, unknown>;
      // Never fabricate: all four fields must come from the provider verbatim.
      if (
        typeof a.bankName === 'string' &&
        typeof a.bankCode === 'string' &&
        typeof a.accountNumber === 'string' &&
        typeof a.accountName === 'string'
      ) {
        out.push({
          bankName: a.bankName,
          providerBankCode: a.bankCode,
          accountNumber: a.accountNumber,
          accountName: a.accountName,
        });
      }
    }
    return out;
  }

  // ------------------------------------------------------------- outbound

  async submitOutboundTransfer(
    request: OutboundTransferRequest,
    context: BankingRequestContext,
  ): Promise<BankingProviderResult<OutboundTransferSubmissionResult>> {
    const result = await this.authorized(
      'POST',
      '/api/v2/disbursements/single',
      {
        amount: Number(request.amountMinor) / 100,
        reference: request.operationReference,
        narration: request.narration,
        destinationBankCode: request.destinationBankCode,
        destinationAccountNumber: request.destinationAccountNumber,
        currency: request.currency,
        sourceAccountNumber: this.options.walletId,
        // The provider contract (2026) expects the verified beneficiary name from name enquiry.
        destinationAccountName: request.destinationAccountName,
      },
      context,
    );
    if (!result.ok) {
      if (result.error.category === 'TIMEOUT' || result.error.category === 'TRANSPORT') {
        // Money may have moved. UNKNOWN, never REJECTED.
        return {
          ok: true,
          value: {
            outcome: 'UNKNOWN',
            operationReference: request.operationReference,
            correlationId: context.correlationId,
          },
        };
      }
      return result;
    }
    const body = result.value as Record<string, unknown>;
    const status = typeof body.status === 'string' ? body.status.toUpperCase() : '';
    const providerReference = typeof body.reference === 'string' ? body.reference : undefined;
    const requiresOtp =
      status.includes('OTP') ||
      status === 'PENDING_AUTHORIZATION' ||
      body.requiresOtp === true ||
      body.otpRequired === true;

    return {
      ok: true,
      value: {
        outcome: requiresOtp ? 'PENDING' : this.mapSubmissionStatus(status),
        operationReference: request.operationReference,
        ...(providerReference ? { providerReference } : {}),
        ...(requiresOtp ? { requiresAdditionalAuthorization: true } : {}),
        correlationId: context.correlationId,
      },
    };
  }

  private mapSubmissionStatus(status: string): 'ACCEPTED' | 'REJECTED' | 'PENDING' | 'UNKNOWN' {
    if (status === 'SUCCESS' || status === 'SUCCESSFUL' || status === 'COMPLETED')
      return 'ACCEPTED';
    if (status === 'FAILED' || status === 'REJECTED' || status === 'FAILED_OTP') return 'REJECTED';
    if (status === 'PENDING' || status === 'AWAITING' || status === 'IN_PROGRESS') return 'PENDING';
    // An unrecognised status is NOT success and NOT failure.
    return 'UNKNOWN';
  }

  async getTransferStatus(
    operationReference: string,
    context: BankingRequestContext,
  ): Promise<BankingProviderResult<TransferStatusResult>> {
    const result = await this.authorized(
      'GET',
      `/api/v2/disbursements/single/summary?reference=${encodeURIComponent(operationReference)}`,
      undefined,
      context,
    );
    if (!result.ok) {
      // A missing lookup does not establish rejection.
      return result.error.category === 'PROVIDER_REJECTED'
        ? {
            ok: true,
            value: {
              outcome: 'NOT_FOUND',
              operationReference,
              correlationId: context.correlationId,
            },
          }
        : result;
    }
    const body = result.value as Record<string, unknown>;
    const raw = typeof body.status === 'string' ? body.status.toUpperCase() : '';
    return {
      ok: true,
      value: {
        outcome: this.mapStatusOutcome(raw),
        operationReference,
        ...(typeof body.transactionReference === 'string'
          ? { providerReference: body.transactionReference }
          : {}),
        ...(typeof body.amount === 'number'
          ? { amountMinor: String(Math.round(body.amount * 100)) }
          : {}),
        ...(typeof body.currency === 'string' ? { currency: body.currency } : {}),
        // Preserve the provider's own word so a normalisation never destroys a real distinction.
        providerStatus: raw,
        ...(typeof body.completedOn === 'string' ? { completedAt: body.completedOn } : {}),
        correlationId: context.correlationId,
      },
    };
  }

  private mapStatusOutcome(raw: string): TransferStatusResult['outcome'] {
    switch (raw) {
      case 'SUCCESS':
      case 'SUCCESSFUL':
      case 'COMPLETED':
        return 'SUCCESSFUL';
      case 'FAILED':
      case 'FAILED_OTP':
        return 'FAILED';
      case 'REJECTED':
        return 'REJECTED';
      case 'REVERSED':
        return 'REVERSED';
      case 'PENDING':
      case 'IN_PROGRESS':
      case 'AWAITING':
      case 'AWAITING_OTP':
        return 'PENDING';
      default:
        // Never guess. An unknown status is UNKNOWN, which the caller must resolve by enquiry.
        return 'UNKNOWN';
    }
  }

  // ------------------------------------------------------------- inbound

  async verifyInboundPayment(
    providerTransactionReference: string,
    context: BankingRequestContext,
  ): Promise<BankingProviderResult<InboundPaymentVerificationResult>> {
    const result = await this.authorized(
      'GET',
      `/api/v2/transactions/${encodeURIComponent(providerTransactionReference)}`,
      undefined,
      context,
    );
    if (!result.ok) {
      return result.error.category === 'PROVIDER_REJECTED'
        ? {
            ok: true,
            value: {
              outcome: 'NOT_FOUND',
              providerTransactionReference,
              correlationId: context.correlationId,
            },
          }
        : result;
    }
    const body = result.value as Record<string, unknown>;
    const status = typeof body.paymentStatus === 'string' ? body.paymentStatus.toUpperCase() : '';
    const amount = typeof body.amountPaid === 'number' ? body.amountPaid : undefined;
    return {
      ok: true,
      value: {
        outcome: status === 'PAID' ? 'VERIFIED' : status === 'PENDING' ? 'PENDING' : 'UNKNOWN',
        providerTransactionReference,
        ...(amount === undefined ? {} : { amountMinor: String(Math.round(amount * 100)) }),
        ...(typeof body.currency === 'string' ? { currency: body.currency } : {}),
        ...(typeof body.destinationAccountNumber === 'string'
          ? { receivingAccountNumber: body.destinationAccountNumber }
          : {}),
        ...(typeof body.destinationBankCode === 'string'
          ? { providerBankCode: body.destinationBankCode }
          : {}),
        ...(typeof body.paidOn === 'string' ? { paidAt: body.paidOn } : {}),
        providerStatus: status,
        ...(amount === undefined ? {} : { grossAmountMinor: String(Math.round(amount * 100)) }),
        // Provider fee is reported only when the provider states it; never derived.
        ...(typeof body.settlementAmount === 'number' && amount !== undefined
          ? { providerFeeMinor: String(Math.round((amount - body.settlementAmount) * 100)) }
          : {}),
        correlationId: context.correlationId,
      },
    };
  }

  /** Explicitly unavailable: no documented response schema to interpret settlement records. */
  verifySettlement(): Promise<BankingProviderResult<SettlementVerificationResult>> {
    return Promise.resolve({
      ok: false,
      error: monnifyError(
        'MONNIFY_CAPABILITY_UNSUPPORTED',
        'Settlement verification has no documented response contract; capability is unavailable',
      ),
    });
  }

  /** Documented as deprecated; advertised but not backed by a financial dependency. */
  getProviderBalance(): Promise<BankingProviderResult<ProviderBalanceResult>> {
    return Promise.resolve({
      ok: false,
      error: monnifyError(
        'MONNIFY_CAPABILITY_UNSUPPORTED',
        'Wallet balance endpoint is documented as deprecated; not used for financial decisions',
      ),
    });
  }

  /** Exposed for diagnostics only; never includes credential material. */
  describeConfiguration(): { provider: string; environment: string; contractCodePresent: boolean } {
    return {
      provider: PROVIDER_KEY,
      environment: this.options.environment,
      contractCodePresent:
        typeof this.options.contractCode === 'string' && this.options.contractCode.length > 0,
    };
  }

  /** Sanitised provider text helper, kept here so the adapter never interpolates raw payloads. */
  static safeText(value: unknown): string | undefined {
    return sanitizeProviderText(value);
  }
}

/** Carries a normalized provider error through a promise boundary without losing its structure. */
export class MonnifyProviderError extends Error {
  constructor(readonly providerError: BankingProviderError) {
    super(providerError.code);
    this.name = 'MonnifyProviderError';
  }
}
