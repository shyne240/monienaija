/**
 * Monnify adapter contract tests.
 *
 * Every response fixture below is a shape taken from Monnify's documented examples. The assertions
 * that matter are not "does it parse" but "does an uncertain outcome stay uncertain", because a
 * parser that turns a timeout into a rejection is how money gets sent twice.
 */
import { MonnifyProvider } from '../src/banking/monnify/monnify.provider';
import type {
  MonnifyHttpClient,
  MonnifyHttpRequest,
  MonnifyHttpResponse,
} from '../src/banking/monnify/monnify.http';

type Handler = (req: MonnifyHttpRequest) => Promise<MonnifyHttpResponse> | MonnifyHttpResponse;

function providerWith(handler: Handler, overrides: Partial<ConstructorParameters<typeof MonnifyProvider>[0]> = {}) {
  const requests: MonnifyHttpRequest[] = [];
  const http: MonnifyHttpClient = {
    send: async (req) => {
      requests.push(req);
      // Login is answered universally so each test only describes the endpoint under test.
      if (req.path === '/api/v1/auth/login') {
        return {
          status: 200,
          body: { requestSuccessful: true, responseBody: { accessToken: 'tok', expiresIn: 3600 } },
        };
      }
      return handler(req);
    },
  };
  const provider = new MonnifyProvider({
    environment: 'sandbox',
    contractCode: '1234567890',
    apiKey: 'MK_TEST_KEY',
    secretKey: 'secret-value',
    http,
    // Documented disbursement wallet fixture. Tests that need it absent pass an override.
    disbursementSourceAccountNumber: '8016472829',
    ...overrides,
  });
  return { provider, requests };
}

const ctx = { correlationId: 'corr-1' };

describe('Monnify bank directory', () => {
  it('maps the documented bank list and keeps provider codes distinct from NIBSS codes', async () => {
    const { provider } = providerWith(() => ({
      status: 200,
      body: {
        requestSuccessful: true,
        responseBody: [
          { name: 'Access bank', code: '044', ussdTemplate: '*901*Amount*AccountNumber#' },
          { name: 'GTBank', code: '058', nibssBankCode: '058' },
        ],
      },
    }));
    const result = await provider.listBanks(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.banks).toHaveLength(2);
      expect(result.value.banks[0]!.providerBankCode).toBe('044');
      expect(result.value.environment).toBe('sandbox');
    }
  });

  it('skips malformed entries rather than inventing a bank', async () => {
    const { provider } = providerWith(() => ({
      status: 200,
      body: {
        requestSuccessful: true,
        responseBody: [{ name: 'No code' }, { code: '044', name: 'Ok' }],
      },
    }));
    const result = await provider.listBanks(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.banks).toHaveLength(1);
  });
});

describe('Monnify account-name enquiry', () => {
  it('resolves a documented name but never claims ownership', async () => {
    const { provider } = providerWith(() => ({
      status: 200,
      body: {
        requestSuccessful: true,
        responseBody: { accountNumber: '0123456789', accountName: 'JOHN DOE', bankCode: '058' },
      },
    }));
    const result = await provider.enquireAccountName(
      { providerBankCode: '058', accountNumber: '0123456789' },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcome).toBe('RESOLVED');
      expect(result.value.accountName).toBe('JOHN DOE');
      // The load-bearing assertion: a name proves the account exists, not that the caller owns it.
      expect(result.value.establishesAccountOwnership).toBe(false);
    }
  });

  it('validates input before spending a provider call', async () => {
    const { provider, requests } = providerWith(() => ({
      status: 200,
      body: { requestSuccessful: true, responseBody: {} },
    }));
    const result = await provider.enquireAccountName(
      { providerBankCode: '058', accountNumber: '123' },
      ctx,
    );
    expect(result.ok).toBe(false);
    // No enquiry request was issued.
    expect(requests.some((r) => r.path.includes('/account/validate'))).toBe(false);
  });

  it('reports an outage as a failure, never as "no such account"', async () => {
    const { provider } = providerWith(() => ({
      status: 503,
      body: { requestSuccessful: false, responseCode: '500', responseMessage: 'service down' },
    }));
    const result = await provider.enquireAccountName(
      { providerBankCode: '058', accountNumber: '0123456789' },
      ctx,
    );
    // An outage must not become a business answer. If this ever returns ok:true the caller would
    // cache "this account does not exist" against a customer who simply hit a bad minute.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).not.toBe('PROVIDER_REJECTED');
      expect(result.error.category).toBe('TRANSPORT');
    }
  });

  it('treats a documented refusal as NOT_FOUND, which is a business answer', async () => {
    const { provider } = providerWith(() => ({
      status: 200,
      body: {
        requestSuccessful: false,
        responseCode: '404',
        responseMessage: 'Account not found',
      },
    }));
    const result = await provider.enquireAccountName(
      { providerBankCode: '058', accountNumber: '0123456789' },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcome).toBe('NOT_FOUND');
      expect(result.value.establishesAccountOwnership).toBe(false);
    }
  });
});

describe('Monnify reserved accounts', () => {
  const provisioned = {
    requestSuccessful: true,
    responseBody: {
      contractCode: '1234567890',
      accountReference: 'acc-ref-1',
      accountName: 'Test Reserved Account',
      currencyCode: 'NGN',
      accounts: [
        {
          bankCode: '50515',
          bankName: 'Moniepoint Microfinance Bank',
          accountNumber: '6254727989',
          accountName: 'Test Reserved Account',
        },
      ],
      reservationReference: 'NWA7DMJ0W2UDK1KN5SLF',
      status: 'ACTIVE',
    },
  };

  it('returns only provider-issued account details, never a synthesized NUBAN', async () => {
    const { provider } = providerWith(() => ({ status: 200, body: provisioned }));
    const result = await provider.provisionVirtualAccount(
      {
        accountReference: 'acc-ref-1',
        accountName: 'Test Reserved Account',
        customerName: 'John Doe',
        customerEmail: 'test@tester.com',
        currency: 'NGN',
        correlationId: 'corr-1',
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcome).toBe('PROVISIONED');
      expect(result.value.accounts[0]!.accountNumber).toBe('6254727989');
      expect(result.value.providerReference).toBe('NWA7DMJ0W2UDK1KN5SLF');
    }
  });

  it('returns UNKNOWN rather than FAILED when provisioning times out — the account may exist', async () => {
    const { provider } = providerWith(() => {
      throw new Error('Timeout');
    });
    const result = await provider.provisionVirtualAccount(
      {
        accountReference: 'acc-ref-2',
        accountName: 'X',
        customerName: 'John Doe',
        customerEmail: 't@t.com',
        currency: 'NGN',
        correlationId: 'corr-1',
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The critical distinction: retrying provisioning could create a second account.
      expect(result.value.outcome).toBe('UNKNOWN');
      expect(result.value.accounts).toHaveLength(0);
    }
  });

  it('reports PENDING when the provider returns no accounts yet', async () => {
    const { provider } = providerWith(() => ({
      status: 200,
      body: { requestSuccessful: true, responseBody: { accountReference: 'r', accounts: [] } },
    }));
    const result = await provider.provisionVirtualAccount(
      {
        accountReference: 'r',
        accountName: 'X',
        customerName: 'Y',
        customerEmail: 't@t.com',
        currency: 'NGN',
        correlationId: 'c',
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.outcome).toBe('PENDING');
  });

  it('reads status from the documented account-record envelope', async () => {
    const { provider } = providerWith(() => ({ status: 200, body: provisioned }));
    const result = await provider.getVirtualAccountStatus('acc-ref-1', ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcome).toBe('ACTIVE');
      expect(result.value.accounts).toHaveLength(1);
    }
  });
});

describe('Monnify outbound disbursement', () => {
  const request = {
    operationReference: 'op-ref-1',
    amountMinor: '150000',
    currency: 'NGN',
    destinationBankCode: '058',
    destinationAccountNumber: '0123456789',
    destinationAccountName: 'JOHN DOE',
    narration: 'Transfer',
    correlationId: 'corr-1',
  };

  it('treats an OTP challenge as PENDING, never as an accepted transfer', async () => {
    const { provider } = providerWith(() => ({
      status: 200,
      body: {
        requestSuccessful: true,
        responseBody: { status: 'AWAITING_OTP', reference: 'ref-1' },
      },
    }));
    const result = await provider.submitOutboundTransfer(request, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcome).toBe('PENDING');
      expect(result.value.requiresAdditionalAuthorization).toBe(true);
    }
  });

  it('returns UNKNOWN on timeout — money may have moved, so this must not look like a rejection', async () => {
    const { provider } = providerWith(() => {
      throw new Error('Timeout');
    });
    const result = await provider.submitOutboundTransfer(request, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.outcome).toBe('UNKNOWN');
  });

  it('normalizes a documented failure to REJECTED', async () => {
    const { provider } = providerWith(() => ({
      status: 200,
      body: {
        requestSuccessful: false,
        responseCode: 'D01',
        responseMessage: 'Insufficient balance',
      },
    }));
    const result = await provider.submitOutboundTransfer(request, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe('PROVIDER_REJECTED');
  });

  it('returns UNKNOWN for a 5xx, because the submission may have been accepted', async () => {
    const { provider } = providerWith(() => ({
      status: 502,
      body: { requestSuccessful: false, responseCode: '500', responseMessage: 'bad gateway' },
    }));
    const result = await provider.submitOutboundTransfer(request, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.outcome).toBe('UNKNOWN');
  });

  it('does not guess an unrecognised status', async () => {
    const { provider } = providerWith(() => ({
      status: 200,
      body: { requestSuccessful: true, responseBody: { status: 'SOMETHING_NEW' } },
    }));
    const result = await provider.submitOutboundTransfer(request, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.outcome).toBe('UNKNOWN');
  });

  it('sends our operation reference so the provider sees one operation per commitment', async () => {
    let sent: unknown;
    const { provider } = providerWith((req) => {
      sent = JSON.parse(String(req.body));
      return {
        status: 200,
        body: { requestSuccessful: true, responseBody: { status: 'SUCCESS' } },
      };
    });
    await provider.submitOutboundTransfer(request, ctx);
    expect((sent as { reference: string }).reference).toBe('op-ref-1');
  });

  it('refuses to send when the documented source wallet is not configured', async () => {
    let calls = 0;
    const { provider } = providerWith(
      () => {
        calls += 1;
        return {
          status: 200,
          body: { requestSuccessful: true, responseBody: { status: 'SUCCESS' } },
        };
      },
      { disbursementSourceAccountNumber: undefined },
    );
    const result = await provider.submitOutboundTransfer(request, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe('CONFIGURATION');
    expect(calls).toBe(0);
  });

  it('maps PENDING_AUTHORIZATION to an OTP challenge, never to a completed transfer', async () => {
    const { provider } = providerWith(() => ({
      status: 200,
      body: {
        requestSuccessful: true,
        responseBody: { status: 'PENDING_AUTHORIZATION', reference: 'ref-otp' },
      },
    }));
    const result = await provider.submitOutboundTransfer(request, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcome).toBe('PENDING');
      expect(result.value.requiresAdditionalAuthorization).toBe(true);
    }
  });

  it('treats Monnify D07 duplicate request as UNKNOWN so recovery uses status enquiry', async () => {
    const { provider } = providerWith(() => ({
      status: 200,
      body: { requestSuccessful: false, responseCode: 'D07', responseMessage: 'duplicate' },
    }));
    const result = await provider.submitOutboundTransfer(request, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.outcome).toBe('UNKNOWN');
  });
});

describe('Monnify transfer status', () => {
  it('maps documented statuses and preserves the provider word', async () => {
    const { provider } = providerWith(() => ({
      status: 200,
      body: {
        requestSuccessful: true,
        responseBody: {
          status: 'SUCCESS',
          transactionReference: 'tx-1',
          amount: 1500,
          currency: 'NGN',
        },
      },
    }));
    const result = await provider.getTransferStatus('op-ref-1', ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcome).toBe('SUCCESSFUL');
      expect(result.value.providerStatus).toBe('SUCCESS');
      expect(result.value.amountMinor).toBe('150000');
    }
  });

  it('maps REVERSED distinctly rather than folding it into FAILED', async () => {
    const { provider } = providerWith(() => ({
      status: 200,
      body: { requestSuccessful: true, responseBody: { status: 'REVERSED' } },
    }));
    const result = await provider.getTransferStatus('op-ref-1', ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.outcome).toBe('REVERSED');
  });

  it('does not treat a missing lookup as rejection', async () => {
    const { provider } = providerWith(() => ({
      status: 200,
      body: { requestSuccessful: false, responseCode: '404', responseMessage: 'not found' },
    }));
    const result = await provider.getTransferStatus('op-ref-1', ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcome).toBe('NOT_FOUND');
      // NOT_FOUND is not REJECTED: the transfer may exist under a different reference.
      expect(result.value.outcome).not.toBe('REJECTED');
    }
  });
});

describe('Monnify documented refund contract', () => {
  const refundRequest = {
    originalProviderReference: 'MNFY|76|2021|000001',
    refundReference: 'RF-2W-TEST-0001',
    amountMinor: '150000',
    currency: 'NGN',
    reason: 'Governed return decision',
    customerNote: 'Returned funds',
    correlationId: 'corr-1',
  };

  it('refuses locally until refund activation is confirmed by the provider owner', async () => {
    let calls = 0;
    const { provider } = providerWith(
      () => {
        calls += 1;
        return { status: 200, body: {} };
      },
      { refundsEnabled: false },
    );
    const result = await provider.initiateRefund(refundRequest, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe('ENTITLEMENT');
    expect(calls).toBe(0);
  });

  it('submits with the original transaction reference and a distinct durable refund reference', async () => {
    let sent: Record<string, unknown> | undefined;
    const { provider } = providerWith(
      (req) => {
        if (req.path === '/api/v1/refunds/initiate-refund') {
          sent = JSON.parse(String(req.body)) as Record<string, unknown>;
          return {
            status: 200,
            body: {
              requestSuccessful: true,
              responseBody: { refundStatus: 'IN_PROGRESS', refundReference: 'RF-2W-TEST-0001' },
            },
          };
        }
        return {
          status: 200,
          body: {
            requestSuccessful: true,
            responseBody: { refundStatus: 'COMPLETED', transactionReference: refundRequest.originalProviderReference },
          },
        };
      },
      { refundsEnabled: true },
    );
    const submitted = await provider.initiateRefund(refundRequest, ctx);
    expect(submitted.ok).toBe(true);
    if (submitted.ok) expect(submitted.value.outcome).toBe('PENDING');
    expect(sent?.transactionReference).toBe(refundRequest.originalProviderReference);
    expect(sent?.refundReference).toBe(refundRequest.refundReference);
    expect(sent?.destinationAccountNumber).toBeUndefined();

    const status = await provider.getRefundStatus('RF-2W-TEST-0001', ctx);
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.value.outcome).toBe('COMPLETED');
      expect(status.value.originalProviderReference).toBe(refundRequest.originalProviderReference);
    }
  });

  it('returns UNKNOWN for a repeated refund reference instead of minting a second one', async () => {
    const { provider } = providerWith(
      () => ({
        status: 200,
        body: { requestSuccessful: false, responseCode: 'R9', responseMessage: 'exists' },
      }),
      { refundsEnabled: true },
    );
    const result = await provider.initiateRefund(refundRequest, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcome).toBe('UNKNOWN');
      expect(result.value.refundReference).toBe(refundRequest.refundReference);
    }
  });
});

describe('Monnify inbound verification', () => {
  it('keeps gross amount and provider fee distinct from settlement', async () => {
    const { provider } = providerWith(() => ({
      status: 200,
      body: {
        requestSuccessful: true,
        responseBody: {
          paymentStatus: 'PAID',
          amountPaid: 78000,
          fee: 400,
          settlementAmount: 77600,
          currencyCode: 'NGN',
          paymentReference: 'MN6254727989',
        },
      },
    }));
    const result = await provider.verifyInboundPayment('MNFY|76|2021|000001', ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.outcome).toBe('VERIFIED');
      expect(result.value.grossAmountMinor).toBe('7800000');
      expect(result.value.providerFeeMinor).toBe('40000');
      // Both are documented response fields, not a derived "fee" invented from the settlement.
      expect(result.value.settlementAmountMinor).toBe('7760000');
      expect(result.value.currency).toBe('NGN');
      expect(result.value.paymentReference).toBe('MN6254727989');
      // paymentSourceInformation/payer account is never used as our receiving account.
      expect(result.value.receivingAccountNumber).toBeUndefined();
    }
  });

  it('reports UNKNOWN for a status it does not recognise', async () => {
    const { provider } = providerWith(() => ({
      status: 200,
      body: { requestSuccessful: true, responseBody: { paymentStatus: 'WEIRD' } },
    }));
    const result = await provider.verifyInboundPayment('ref', ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.outcome).toBe('UNKNOWN');
  });
});

describe('capabilities the adapter deliberately does not claim', () => {
  it('refuses settlement verification rather than inventing a schema', async () => {
    const { provider } = providerWith(() => ({ status: 200, body: {} }));
    const result = await provider.verifySettlement();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('MONNIFY_CAPABILITY_UNSUPPORTED');
    expect(provider.descriptor.capabilities.SETTLEMENT_VERIFICATION).toBe(false);
  });

  it('flags the balance endpoint as deprecated and refuses to base a decision on it', async () => {
    const { provider } = providerWith(() => ({ status: 200, body: {} }));
    const result = await provider.getProviderBalance();
    expect(result.ok).toBe(false);
    const descriptor = provider.descriptor.descriptors.find(
      (d) => d.key === 'PROVIDER_BALANCE_ENQUIRY',
    );
    expect(descriptor?.maturity).toBe('DEPRECATED');
  });

  it('never exposes the secret in its diagnostic projection', () => {
    const { provider } = providerWith(() => ({ status: 200, body: {} }));
    const described = JSON.stringify(provider.describeConfiguration());
    expect(described).not.toContain('secret-value');
    expect(described).not.toContain('MK_TEST_KEY');
  });
});
