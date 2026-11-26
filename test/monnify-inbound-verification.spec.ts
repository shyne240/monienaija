import { isAllowedMonnifyPath } from '../src/banking/monnify/monnify.http';
import type { MonnifyHttpClient, MonnifyHttpRequest } from '../src/banking/monnify/monnify.http';
import { MonnifyProvider } from '../src/banking/monnify/monnify.provider';

/**
 * Monnify adapter contract for inbound verification.
 *
 * The response below is shaped exactly like Monnify's documented transaction-query response. Its
 * purpose is to prove that Monnify-specific field names stay inside the adapter and that the
 * platform receives integer minor units, separate provider fee/settlement, and the merchant's own
 * payment reference. No live credential, transfer or sandbox simulator is involved.
 */
describe('Monnify provider — documented inbound verification', () => {
  const documentedResponse = {
    requestSuccessful: true,
    responseMessage: 'success',
    responseCode: '0',
    responseBody: {
      transactionReference: 'MNFY|67|20240601|000023',
      paymentReference: 'MN12345678901234567890',
      amountPaid: 10000,
      totalPayable: 10000,
      settlementAmount: 9825,
      paidOn: '2024-06-01T10:45:00.000+0000',
      createdOn: '2024-06-01T10:30:00.000+0000',
      completedOn: '2024-06-01T10:45:00.000+0000',
      paymentStatus: 'PAID',
      paymentMethod: 'ACCOUNT_TRANSFER',
      currencyCode: 'NGN',
      fee: 175,
      customerDTO: { email: 'amina@example.com', name: 'Amina Bello' },
      metaData: {},
      paymentSourceInformation: [
        {
          bankCode: '058',
          amountPaid: 10000,
          accountName: 'AMINA BELLO',
          accountNumber: '0123456789',
        },
      ],
    },
  };

  function fakeHttp(responseBody: unknown = documentedResponse): MonnifyHttpClient & {
    paths: string[];
  } {
    const paths: string[] = [];
    return {
      paths,
      send: (request: MonnifyHttpRequest) => {
        paths.push(request.path);
        if (request.path === '/api/v1/auth/login') {
          return Promise.resolve({
            status: 200,
            body: {
              requestSuccessful: true,
              responseCode: '0',
              responseBody: { accessToken: 'synthetic-token', expiresIn: 3600 },
            },
          });
        }
        return Promise.resolve({ status: 200, body: responseBody });
      },
    };
  }

  function provider(http: MonnifyHttpClient): MonnifyProvider {
    return new MonnifyProvider({
      environment: 'sandbox',
      contractCode: 'SYNTHETIC_CONTRACT',
      apiKey: 'synthetic-api-key',
      secretKey: 'synthetic-secret-key',
      http,
    });
  }

  it('uses the documented merchant transaction query and allows only that endpoint', () => {
    expect(
      isAllowedMonnifyPath(
        '/api/v2/merchant/transactions/query?transactionReference=MNFY%7C67%7C20240601%7C000023',
      ),
    ).toBe(true);
    expect(
      isAllowedMonnifyPath('/api/v2/merchant/transactions/queryX?transactionReference=MNFY%7C67'),
    ).toBe(false);
  });

  it('maps the documented response without treating the payer account as our destination', async () => {
    const http = fakeHttp();
    const result = await provider(http).verifyInboundPayment('MNFY|67|20240601|000023', {
      correlationId: 'monnify-verify-evidence',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(http.paths).toContain(
      '/api/v2/merchant/transactions/query?transactionReference=MNFY%7C67%7C20240601%7C000023',
    );
    expect(result.value).toMatchObject({
      outcome: 'VERIFIED',
      providerTransactionReference: 'MNFY|67|20240601|000023',
      paymentReference: 'MN12345678901234567890',
      currency: 'NGN',
      grossAmountMinor: '1000000',
      providerFeeMinor: '17500',
      settlementAmountMinor: '982500',
      providerStatus: 'PAID',
      correlationId: 'monnify-verify-evidence',
    });
    // paymentSourceInformation is the payer's account; attributing it to a customer wallet here
    // would let a payer choose which wallet receives money.
    expect(result.value.receivingAccountNumber).toBeUndefined();
  });

  it('does not treat a partially paid or overpaid transaction as creditable', async () => {
    for (const paymentStatus of ['PARTIALLY_PAID', 'OVERPAID']) {
      const http = fakeHttp({
        ...documentedResponse,
        responseBody: { ...documentedResponse.responseBody, paymentStatus },
      });
      const result = await provider(http).verifyInboundPayment('MNFY|partial', {
        correlationId: 'monnify-conflict-evidence',
      });
      expect(result.ok && result.value.outcome).toBe('CONFLICT');
    }
  });
});
